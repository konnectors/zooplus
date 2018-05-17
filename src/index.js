const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const cheerio = require('cheerio')
const request = requestFactory({
  // the debug mode shows all the details about http request and responses. Very usefull for
  // debugging but very verbose. That is why it is commented out by default
  // debug: true,
  // activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // this allows request-promise to keep cookies between requests
  jar: true
})

const baseUrl = 'https://www.zooplus.fr'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.email, fields.password)
  log('info', 'Fetch years URLs')
  const $ = await request(`${baseUrl}/account/orders/overview`)
  const yearsURLs = getYearsURLs($)

  return Promise.resolve()
}

function authenticate(email, password) {
  return signin({
    url: `https://www.zooplus.fr/account`,
    formSelector: 'form[name="loginForm"]',
    formData: { email, password },
    validate: (statusCode, $) => {
      if ($(`.logout__btn`).length === 1) {
        return true
      } else {
        const errors = $('.form__field.ERROR .error__message').map((i, el) => {
          return $(el).text()
        })
        log('info', errors)
        return false
      }
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
