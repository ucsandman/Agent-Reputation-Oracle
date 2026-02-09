# Lessons Learned

## x402 SDK
- `@x402/evm` is a separate package, not bundled with `@x402/express`
- `paymentMiddleware` takes `(routes: RoutesConfig, server: x402ResourceServer, paywallConfig?, paywall?, syncFacilitatorOnStart?)`
- Route format: `"VERB /path/*"` with more specific routes first
- `RouteConfig.accepts` expects `PaymentOption` with `scheme`, `payTo`, `price`, `network`
- `HTTPFacilitatorClient` constructor takes optional `FacilitatorConfig` with `url` field
