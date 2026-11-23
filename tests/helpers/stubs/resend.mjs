// Mocked Resend SDK. Nothing leaves the machine: every send is handed to
// globalThis.__t.resend(payload, options, apiKey), which the test scripts.
export class Resend {
  constructor(apiKey) {
    this.apiKey = apiKey
    this.emails = {
      send: async (payload, options) => {
        const mock = globalThis.__t?.resend
        if (typeof mock !== 'function') throw new Error('Resend mock not configured')
        return mock(payload, options, apiKey)
      },
    }
  }
}
