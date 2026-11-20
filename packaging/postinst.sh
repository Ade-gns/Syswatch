#!/bin/sh
# Après installation du paquet : prise en compte du service privilégié de SysWatch.
systemctl daemon-reload 2>/dev/null || true
busctl call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig >/dev/null 2>&1 || true
exit 0
