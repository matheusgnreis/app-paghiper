'use strict'

// log on files
const logger = require('console-files')
// get store and order ID from local database based on PagHiper transaction code
const { get } = require(process.cwd() + '/lib/database')
// read configured E-Com Plus app data
const getConfig = require(process.cwd() + '/lib/store-api/get-config')
// update order transaction status on Store API
const updatePaymentStatus = require(process.cwd() + '/lib/store-api/update-payment-status')
// list orders from E-Com Plus Store API searching by transaction code
const listOrdersByTransaction = require(process.cwd() + '/lib/store-api/list-orders-by-transaction')
// read full notification body from PagHiper API
const readNotification = require(process.cwd() + '/lib/paghiper-api/read-notification')
// get intermediator object from payment gateway object
const { intermediator } = require(process.cwd() + '/lib/new-payment-gateway')()

const CLIENT_ERR = 'invalidClient'

module.exports = appSdk => {
  return (req, res) => {
    const { body } = req
    // handle PagHiper notification request
    // https://dev.paghiper.com/reference#qq
    const transactionCode = (body && body.transaction_id)
    if (!transactionCode) {
      return res.sendStatus(400)
    }

    // declare reusable Store API authentication object and Store ID
    let sdkClient, storeId
    // get Store ID first
    get(transactionCode)

      .then(data => {
        storeId = data.storeId
        // logger.log(storeId)
        // pre-authenticate to reuse auth object
        return appSdk.getAuth(storeId)
      })

      .then(auth => {
        sdkClient = { appSdk, storeId, auth }
        // get app configured options
        // including hidden (authenticated) data
        return getConfig(sdkClient, true)
      })

      .then(config => {
        const token = config.paghiper_token
        if (token && config.paghiper_api_key === body.apiKey) {
          // read full notification body from PagHiper API
          return readNotification(Object.assign({}, body, { token }))
        } else {
          const err = new Error('API key does not match')
          err.name = CLIENT_ERR
          throw err
        }
      })

      .then(paghiperResponse => {
        // we have full PagHiper notification object here
        // parse PagHiper status to E-Com Plus financial status
        let { status } = paghiperResponse.status_request
        switch (status) {
          case 'pending':
          case 'paid':
          case 'refunded':
            // is the same
            break

          case 'canceled':
            status = 'voided'
            break
          case 'processing':
            status = 'under_analysis'
            break
          case 'reserved':
            // https://atendimento.paghiper.com/hc/pt-br/articles/360016177713
            status = 'authorized'
            break

          default:
            // ignore unknow status
            return true
        }

        // list order IDs for respective transaction code
        return listOrdersByTransaction(sdkClient, transactionCode, intermediator.code)
          .then(orders => {
            // change transaction status on E-Com Plus API
            const notificationCode = body.notification_id
            const promises = []
            orders.forEach(order => {
              promises.push(updatePaymentStatus(sdkClient, order._id, status, notificationCode))
            })
            return Promise.all(promises)
          })
      })

      .then(() => {
        // Store API was changed with current transaction status
        // all done
        res.status(204)
        res.end()
      })

      .catch(err => {
        const { message } = err
        let statusCode
        if (!err.request && err.name !== CLIENT_ERR && err.code !== 'EMPTY') {
          // not Axios error ?
          logger.error(err)
          statusCode = 500
        } else {
          let debugMsg = `[#${storeId} / ${transactionCode}] Unhandled notification: ${err.request.url} `
          if (err.response) {
            debugMsg += `${err.response.status}`
          } else {
            debugMsg += message
          }
          logger.log(debugMsg)
          statusCode = 409
        }
        // return response with error
        res.status(statusCode)
        res.send({
          error: 'paghiper_notification_error',
          message
        })
      })
  }
}
