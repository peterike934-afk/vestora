const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./i18n/request.js");

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/admin/verify-transaction": ["./node_modules/tiny-secp256k1/**/*"],
  },
};

module.exports = withNextIntl(nextConfig);