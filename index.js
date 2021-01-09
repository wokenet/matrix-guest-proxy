const http = require('http')
const https = require('https')
const { match: matchURL } = require('path-to-regexp')

class CachedEndpoint {
  constructor(pattern, isCachedFunc) {
    this.match = matchURL(pattern)
    this.isCachedFunc = isCachedFunc
  }

  isCached(searchParams, body) {
    let data
    try {
      data = JSON.parse(body)
    } catch (err) {
      console.error('Error parsing JSON:', err)
      return false
    }
    return this.isCachedFunc ? this.isCachedFunc(searchParams, data) : true
  }
}

class CachedResponse {
  constructor(statusCode, headers, body) {
    this.statusCode = statusCode
    this.headers = headers
    this.body = body
  }

  writeTo(response) {
    response.writeHead(this.statusCode, this.headers).end(this.body)
  }
}

function matrixError(errcode, error) {
  return JSON.stringify({ errcode, error })
}

function makeRequest(url) {
  return new Promise((resolve) => {
    const get = url.startsWith('https') ? https.get : http.get
    get(url, (res) => {
      const { statusCode, headers } = res

      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        resolve(new CachedResponse(statusCode, headers, body))
      })
    }).on('error', (err) => {
      console.error('Request error', err)
      const matrixErr = matrixError('ERR_UNKNOWN', 'Error proxying request')
      resolve(new CachedResponse(500, {}, matrixErr))
    })
  })
}

const endpoints = [
  new CachedEndpoint('/_matrix/client/versions'),
  new CachedEndpoint('/_matrix/client/r0/rooms/:room/initialSync'),
  new CachedEndpoint('/_matrix/client/r0/rooms/:room/messages'),
  new CachedEndpoint('/_matrix/client/r0/rooms/:room/state/:stateKey'),
  new CachedEndpoint(
    '/_matrix/client/r0/sync',
    ({ since }, { next_batch }) => since !== next_batch,
  ),
  new CachedEndpoint(
    '/_matrix/client/r0/events',
    ({ from }, { end }) => from !== end,
  ),
]

function main() {
  const port = process.env.PORT ?? 9009
  const cacheTTLSecs = process.env.CACHE_TTL_SECONDS ?? 60
  const matrixServer = process.env.MATRIX_SERVER
  if (!matrixServer) {
    console.error('Error: MATRIX_SERVER environment variable required')
  }
  const accessToken = process.env.MATRIX_ACCESS_TOKEN
  if (!accessToken) {
    console.error('Error: MATRIX_ACCESS_TOKEN environment variable required')
  }

  const requests = new Map()

  const server = http.createServer((req, res) => {
    const reqURL = new URL(req.url, matrixServer)

    if (req.method !== 'GET' && req.method !== 'OPTIONS') {
      res.writeHead(405)
      res.end(matrixError('M_UNKNOWN', 'Invalid method'))
      return
    }

    const endpoint = endpoints.find((e) => e.match(reqURL.pathname))
    if (!endpoint) {
      res.writeHead(404)
      res.end(matrixError('M_NOT_FOUND', 'Unknown proxy request'))
      return
    }

    reqURL.searchParams.set('access_token', accessToken)
    const reqURLStr = reqURL.toString()

    let cacheEntry = requests.get(reqURLStr)
    if (!cacheEntry) {
      // Make a request and store the promise in the cache index so subsequent requests wait on the same response.
      cacheEntry = makeRequest(reqURLStr)
      requests.set(reqURLStr, cacheEntry)

      // Handle cache behavior when request promise resolves.
      cacheEntry.then((cachedResponse) => {
        // Check if the response is valid to be cached for this endpoint.
        // When long-polling responses hit the timeout server-side, we'll get an empty response from the server which should not be cached.
        if (
          !endpoint.isCached(
            Object.fromEntries(reqURL.searchParams.entries()),
            cachedResponse.body,
          )
        ) {
          requests.delete(reqURLStr)
          return
        }

        // Otherwise, keep the cached version for cacheTTLSecs, at which point we'll delete it from the cache.
        setTimeout(() => {
          requests.delete(reqURLStr)
        }, cacheTTLSecs * 1000)
      })
    }

    // Forward response to client when it's available.
    cacheEntry.then((cachedResponse) => {
      try {
        cachedResponse.writeTo(res)
      } catch (err) {
        console.error('Error sending response:', err)
      }
    })
  })

  server.listen(port)
}

main()
