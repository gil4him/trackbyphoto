#!/bin/bash
# Point the native apps at one Firebase project: native-config.sh full|simple
#
# Copies config/<edition>/GoogleService-Info.plist and google-services.json
# into the iOS and Android projects, then runs `npx cap sync`. Before copying
# it checks that both files belong to that edition's project and to the
# bundle id / applicationId the Xcode and Gradle projects actually build.
#
# The two destination files are tracked; the committed state is `full`.
# Switch back with `npm run native:full` before committing.
set -euo pipefail

ED="${1:?usage: native-config.sh full|simple}"
APP="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$APP/../config/$ED"
case "$ED" in
  full)   WANT=trackbyphoto-app ;;
  simple) WANT=daylie-simple-4df13 ;;
  *) echo "edition must be full or simple" >&2; exit 1 ;;
esac
PLIST="$SRC/GoogleService-Info.plist"
JSON="$SRC/google-services.json"
fail() { echo "native-config: $*" >&2; exit 1; }
[ -f "$PLIST" ] || fail "missing $PLIST"
[ -f "$JSON" ] || fail "missing $JSON"

p_proj=$(/usr/libexec/PlistBuddy -c 'Print PROJECT_ID' "$PLIST")
p_bundle=$(/usr/libexec/PlistBuddy -c 'Print BUNDLE_ID' "$PLIST")
j_proj=$(node -p "require('$JSON').project_info.project_id")
[ "$p_proj" = "$WANT" ] || fail "$PLIST is for project $p_proj, expected $WANT"
[ "$j_proj" = "$WANT" ] || fail "$JSON is for project $j_proj, expected $WANT"

# Every build configuration in the Xcode project must build the plist's bundle id.
ios_ids=$(grep -o 'PRODUCT_BUNDLE_IDENTIFIER = [^;]*' "$APP/ios/App/App.xcodeproj/project.pbxproj" \
  | sed 's/.*= //' | sort -u)
[ "$ios_ids" = "$p_bundle" ] || fail "iOS builds '$ios_ids' but the plist is for $p_bundle"

droid_id=$(grep -m1 -o 'applicationId "[^"]*"' "$APP/android/app/build.gradle" | cut -d'"' -f2)
node -e "
  const ids = require('$JSON').client.map(c => c.client_info.android_client_info.package_name)
  if (!ids.includes('$droid_id')) {
    console.error('native-config: google-services.json has ' + ids.join(', ') + ' but Gradle builds $droid_id')
    process.exit(1)
  }" || exit 1

cp "$PLIST" "$APP/ios/App/App/GoogleService-Info.plist"
cp "$JSON" "$APP/android/app/google-services.json"
echo "Native config -> $ED ($WANT, $p_bundle)"
(cd "$APP" && npx cap sync)
if [ "$ED" != full ]; then
  echo "NOTE: the native Firebase configs now point at $WANT. Run 'npm run native:full' before committing."
fi
