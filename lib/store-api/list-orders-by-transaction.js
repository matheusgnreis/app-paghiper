'use strict'

// log on files
const logger = require('console-files')
// handle Store API errors
const errorHandling = require('./error-handling')

module.exports = ({ appSdk, storeId, auth }, transactionCode, intermediatorCode) => {
  // list orders from E-Com Plus Store API searching by transaction code
  // https://developers.e-com.plus/docs/api/#/store/orders/orders
  let url = `/orders.json?transactions.intermediator.transaction_code=${transactionCode}`
  if (intermediatorCode) {
    url += `&transactions.app.intermediator.code=${intermediatorCode}`
  }
  logger.log(url)
  const method = 'GET'
  const data = null

  // send and return authenticated Store API request
  return appSdk.apiRequest(storeId, url, method, data, auth)
    .catch(err => {
      errorHandling(err)
      throw err
    })
}