# matrix-guest-proxy

A tiny caching proxy layer for Matrix to allow a large number of clients to share a single access_token. Useful for deployments with extremely high read-only guest load.

Only a couple endpoints for reading room events and state are supported. The proxy is aware of Matrix's `sync` and `events` long-polling endpoints and batches all waiting client long-polls behind a single request to the Matrix backend.

## Options

`PORT`: Specify the port the http server will listen on.  
`CACHE_TTL_SECONDS`: Duration to cache successful responses.  
`MATRIX_SERVER`: Matrix server endpoint.  
`MATRIX_ACCESS_TOKEN`: Access token for requests.
