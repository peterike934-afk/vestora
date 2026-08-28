/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      "/api/admin/verify-transaction": ["./node_modules/tiny-secp256k1/**/*"],
    },
  },
};

module.exports = nextConfig;