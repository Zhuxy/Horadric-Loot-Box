# Horadric Loot Box — build, package and install helpers.
#
#   make            build the app bundle and install it into /Applications
#   make install    same as above
#   make desktop    explicit alias: compile and install the desktop app
#   make dmg        build the .dmg installer too
#   make run        install, then launch the app
#   make ios        build, sign and install the iOS app (scaffold, see target)
#   make clean      remove build output
#   make help       list every target
#
# Override the install location for a user-local copy:
#   make install INSTALL_DIR=~/Applications

SHELL           := /bin/bash

APP_NAME        := Horadric Loot Box
BIN_NAME        := horadric-loot-box
BUNDLE_DIR      := src-tauri/target/release/bundle
MACOS_APP       := $(BUNDLE_DIR)/macos/$(APP_NAME).app
DMG_DIR         := $(BUNDLE_DIR)/dmg

INSTALL_DIR     ?= /Applications
# Expand a leading ~ so the quoted paths below still work with INSTALL_DIR=~/Applications.
INSTALL_DIR     := $(subst ~,$(HOME),$(INSTALL_DIR))
INSTALLED_APP   := $(INSTALL_DIR)/$(APP_NAME).app

NPM             ?= npm
OPEN            ?= open

.DEFAULT_GOAL   := install

.PHONY: help all desktop install app build dmg run ios dev test typecheck check-tauri deps clean distclean uninstall

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}'

all: install ## Alias for install

desktop: install ## Compile and install the desktop app

# Reinstall JS dependencies only when the lockfile is newer than the current install.
node_modules/.package-lock.json: package-lock.json
	$(NPM) ci

deps: ## Install JavaScript dependencies from package-lock.json
	$(NPM) ci

app: node_modules/.package-lock.json ## Build the frontend + .app bundle (no installers)
	$(NPM) run tauri -- build --bundles app

build: node_modules/.package-lock.json ## Build the frontend + every bundle configured for this platform
	$(NPM) run desktop:build

install: app ## Build and install the .app into the install directory
	@mkdir -p "$(INSTALL_DIR)"
	@echo "==> Stopping any running copy"
	-@pkill -x $(BIN_NAME) 2>/dev/null || true
	@echo "==> Installing to $(INSTALLED_APP)"
	@rm -rf "$(INSTALLED_APP)"
	@cp -R "$(MACOS_APP)" "$(INSTALL_DIR)/"
	@# A locally built app is unsigned; drop the quarantine flag so Gatekeeper lets it run.
	@xattr -dr com.apple.quarantine "$(INSTALLED_APP)" 2>/dev/null || true
	@printf '==> Installed %s (version %s)\n' \
		"$(INSTALLED_APP)" \
		"$$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' '$(INSTALLED_APP)/Contents/Info.plist' 2>/dev/null || echo unknown)"

dmg: build ## Build every bundle, then report the .dmg path
	@ls -t "$(DMG_DIR)"/*.dmg 2>/dev/null | head -1 | sed 's/^/==> Built /' \
		|| echo "==> No .dmg produced (is 'dmg' in bundle targets?)"

run: install ## Install, then launch the app
	$(OPEN) "$(INSTALLED_APP)"

# iOS: scaffold for the mobile entry. Runs every stage that is ready and stops
# at the first missing piece with instructions. Remaining before this goes
# green on your Mac: `npx tauri ios init` (once), Rust iOS stubs
# (is_game_running / reveal_backups / art_detect_installs), the build.rs
# TARGET_OS_MAC widen for iOS, platform/ios.ts, and the mobile UI itself.
ios: node_modules/.package-lock.json ## Build, sign and install the iOS app (scaffold)
	$(NPM) run build:mobile
	@if [ "$$(uname)" != "Darwin" ]; then \
		echo "==> iOS packaging needs macOS + Xcode (this machine is $$(uname -s))"; exit 1; fi
	@command -v xcodebuild >/dev/null 2>&1 || \
		{ echo "==> Xcode command-line tools not found"; exit 1; }
	@if [ ! -d "src-tauri/gen/apple" ]; then \
		echo "==> iOS project not initialized yet."; \
		echo "    On your Mac, run once: npx tauri ios init"; exit 1; fi
	@echo "==> Building iOS bundle (dist-mobile frontend + Rust backend)"
	$(NPM) run tauri -- ios build --config src-tauri/tauri.ios.conf.json
	@echo "==> TODO: sign with your Apple ID (open src-tauri/gen/apple in Xcode once,"
	@echo "    pick your Team for automatic signing; a free Apple ID works with 7-day certs),"
	@echo "    then install to the device from Xcode or: xcrun devicectl device install app --device <id> <file>.ipa"

dev: node_modules/.package-lock.json ## Run the desktop app in development mode
	$(NPM) run desktop:dev

test: node_modules/.package-lock.json ## Run the test suite
	$(NPM) test

typecheck: node_modules/.package-lock.json ## Type-check the TypeScript sources
	$(NPM) run typecheck

check-tauri: ## Verify the npm and Rust Tauri versions match
	$(NPM) run check:tauri

uninstall: ## Quit and remove the installed .app from $(INSTALL_DIR)
	-@pkill -x $(BIN_NAME) 2>/dev/null || true
	rm -rf "$(INSTALLED_APP)"
	@echo "==> Removed $(INSTALLED_APP)"

clean: ## Remove frontend and bundled output
	rm -rf dist dist-web dist-mobile
	rm -rf src-tauri/target/release/bundle
	rm -f src-tauri/target/release/$(BIN_NAME)
	@echo "==> Cleaned build output"

distclean: clean ## Also remove the whole Rust build cache (use after moving the repo)
	rm -rf src-tauri/target
	@echo "==> Removed src-tauri/target"
