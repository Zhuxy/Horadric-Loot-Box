# Horadric Loot Box — build, package and install helpers.
#
#   make            build the app bundle and install it into /Applications
#   make install    same as above
#   make dmg        build the .dmg installer too
#   make run        install, then launch the app
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

.PHONY: help all install app build dmg run dev test typecheck check-tauri deps clean distclean uninstall

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}'

all: install ## Alias for install

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
	rm -rf dist dist-web
	rm -rf src-tauri/target/release/bundle
	rm -f src-tauri/target/release/$(BIN_NAME)
	@echo "==> Cleaned build output"

distclean: clean ## Also remove the whole Rust build cache (use after moving the repo)
	rm -rf src-tauri/target
	@echo "==> Removed src-tauri/target"
