#!/bin/sh
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(which chromium)
exec node index.js
