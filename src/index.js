const {
  BaseKonnector,
  requestFactory,
  log,
  errors
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
  await authenticate.bind(this)(fields.email, fields.password)

  log('info', 'Fetch years URLs')
  const $ = await request(`${baseUrl}/account/orders/overview`)
  const yearsURLs = getYearsURLs($)

  log('info', 'Get bills')
  const bills = await getAllBills(yearsURLs)

  log('info', 'Save bills')
  return this.saveBills(bills, fields.folderPath, {
    linkBankOperations: false,
    sourceAccountIdentifier: fields.email,
    fileIdAttributes: ['vendorRef']
  })
}

async function authenticate(email, password) {
  await this.deactivateAutoSuccessfulLogin()
  await request.get(`${baseUrl}/account`)
  const $body = await request.get('https://www.zooplus.fr/web/sso/login')
  const actionUrlRgx = new RegExp(`"actionUrl": "(.*)"`)
  const ssoUrl = $body
    .html()
    .split(`\n`)
    .find(line => line.match(actionUrlRgx))
    .match(actionUrlRgx)[1]

  const $ = await request.post(ssoUrl, {
    form: {
      'X-CSRF-Token': undefined,
      username: email,
      password: password,
      _target8: ''
    }
  })

  const isLoginSuccess = $.html().includes('LOGIN_SUCCESS')

  if (!isLoginSuccess) {
    const errorRgx = new RegExp(`"message": {"type": "error","text":"(.*)"`)
    const errorLine = $.html()
      .split('\n')
      .find(line => line.match(errorRgx))
    if (errorLine) {
      log('error', errorLine)
      if (
        [
          'keycloak.login.error.invalid_credentials',
          'keycloak.login.error.unknown_user'
        ].includes(errorLine.match(errorRgx)[1])
      ) {
        throw new Error(errors.LOGIN_FAILED)
      } else {
        throw new Error(errors.VENDOR_DOWN)
      }
    } else {
      log('error', 'could not parse error message')
      throw new Error(errors.VENDOR_DOWN)
    }
  }
  await this.notifySuccessfulLogin()
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
