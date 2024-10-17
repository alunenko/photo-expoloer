#!/bin/bash

# Function to open browser with google.com
open_browser() {
  case "$1" in
    Darwin*) open "http://localhost:3000" ;;    # macOS
    Linux*) xdg-open "http://localhost:3000" ;; # Linux
    CYGWIN*|MINGW32*|MSYS*|MINGW*) start "http://localhost:3000" ;; # Windows
    *) echo "Unsupported OS" ;;
  esac
}

# Get the current operating system
os=$(uname)

# Open the browser
open_browser "$os"
