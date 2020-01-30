const {
  BaseKonnector,
  requestFactory,
  signin,
  saveBills,
  log
} = require('cozy-konnector-libs')
const cheerio = require('cheerio')
const request = requestFactory({
  // debug: true,
  cheerio: true,
  json: false,
  jar: true,
  headers: {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  }
})

const baseUrl = 'https://www.zooplus.fr'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.email, fields.password)

  log('info', 'Fetch years URLs')
  const $ = await request(`${baseUrl}/account/orders/overview`)
  const yearsURLs = getYearsURLs($)

  log('info', 'Get bills')
  const bills = await getAllBills(yearsURLs)

  log('info', 'Save bills')
  return saveBills(bills, fields.folderPath, {
    linkBankOperations: false,
    sourceAccount: this.accountId,
    sourceAccountIdentifier: fields.email,
    fileIdAttributes: ['vendorRef']
  })
}

function authenticate(email, password) {
  return signin({
    requestInstance: request,
    url: `${baseUrl}/account`,
    formSelector: 'form[name="loginForm"]',
    formData: { email, password },
    validate: (statusCode, $) => {
      const errInForm = $('.form__field.ERROR .error_message')
      const errAlert = $('.alert-danger b').text()

      if (!errAlert && errInForm.length === 0) {
        return true
      }

      let errors = errInForm.map((i, el) => $(el).text())
      errors = Array.from(errors).concat(errAlert)
      log('info', errors)
      return false
    }
  })
}

function getYearsURLs($) {
  const $select = cheerio.load($('#year-selector-filter').html())
  const years = $select('option')
    .map((i, el) => {
      return baseUrl + $(el).attr('value')
    })
    .get()

  return years
}

function getAllBills(yearsURLs) {
  return Promise.all(yearsURLs.map(getYearBills)).then(billsByYears =>
    billsByYears.reduce((bills, year) => [...bills, ...year], [])
  )
}

function getYearBills(yearURL) {
  return request(yearURL).then($ => {
    const $rows = $('.order-overview-table__row')
    const bills = $rows
      .map((i, el) => getBill($(el)))
      .filter((i, el) => Boolean(el))
      .get()

    return bills
  })
}

function getBill($el) {
  const { amount, currency } = getAmountAndCurrency($el)

  if (getCommandState($el) !== 'Commande expédiée') return false

  return {
    vendor: 'ZooPlus',
    date: getDate($el),
    amount,
    currency,
    fileurl: getInvoiceURL($el),
    filename: getFilename($el),
    vendorRef: getInvoiceNumber($el)
  }
}

function formatAmount(rawAmount) {
  const amount = parseFloat(rawAmount.slice(0, -2).replace(',', '.'))

  return amount
}

function getCurrency(rawAmount) {
  return rawAmount.slice(-1)
}

function getCommandState($el) {
  return $el
    .find('.markMeIfFailed')
    .text()
    .trim()
}

function getAmountAndCurrency($el) {
  const rawAmount = $el
    .find('.col-xs-12.col-md-3.keep-text-right p')
    .text()
    .trim()

  return {
    amount: formatAmount(rawAmount),
    currency: getCurrency(rawAmount)
  }
}

function getDate($el) {
  const rawDate = $el
    .find('.col-xs-12.col-md-3:not(.keep-text-right) p')
    .text()
    .trim()

  const date = formatDate(rawDate)

  return date
}

function formatDate(rawDate) {
  const day = parseInt(rawDate.substr(0, 2))
  const month = parseInt(rawDate.substr(3, 2)) - 1
  const year = parseInt(`20${rawDate.substr(-2)}`)

  return new Date(year, month, day)
}

function getInvoiceURL($el) {
  const invoiceURL =
    baseUrl + $el.find('a[href^="/account/orders/invoice"]').attr('href')

  return invoiceURL
}

function getInvoiceNumber($el) {
  const invoiceNumber = $el
    .find('.col-xs-12.col-md-4 a')
    .text()
    .trim()

  return invoiceNumber
}

function getFilename($el) {
  const dateISO = getDate($el).toISOString()
  const amount = `${getAmountAndCurrency($el).amount}`.replace('.', '-')
  const invoiceNumber = getInvoiceNumber($el)

  return `${dateISO}_${amount}_${invoiceNumber}.pdf`
}
