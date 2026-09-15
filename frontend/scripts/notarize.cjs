// electron-builder afterSign hook: notarizes the signed macOS app with Apple.
// Runs only when the app was actually signed and Apple credentials are set;
// otherwise it logs and returns so unsigned local/CI builds still succeed.
//
// Credentials (either set):
//   App Store Connect API key: APPLE_API_KEY (path to .p8), APPLE_API_KEY_ID, APPLE_API_ISSUER
//   Apple ID:                  APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID

const path = require("node:path");

exports.default = async function notarizeApp(context) {
  if (context.electronPlatformName !== "darwin") return;

  const env = process.env;
  const hasApiKey = env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER;
  const hasAppleId = env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID;
  if (!hasApiKey && !hasAppleId) {
    console.log("  • notarization skipped: no Apple credentials in the environment");
    return;
  }
  if (!env.CSC_LINK && !env.CSC_NAME) {
    console.log("  • notarization skipped: app is not signed with a Developer ID certificate");
    return;
  }

  const { notarize } = await import("@electron/notarize");
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • notarizing ${appPath}`);

  await notarize(hasApiKey
    ? {
        appPath,
        appleApiKey: env.APPLE_API_KEY,
        appleApiKeyId: env.APPLE_API_KEY_ID,
        appleApiIssuer: env.APPLE_API_ISSUER,
      }
    : {
        appPath,
        appleId: env.APPLE_ID,
        appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: env.APPLE_TEAM_ID,
      });
};
