#!/bin/sh
# Avant désinstallation : arrêt du service (il rend les ventilateurs au firmware).
systemctl stop syswatch-helper.service 2>/dev/null || true
exit 0
