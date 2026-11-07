"""Gateway: subscribe MQTT -> validate/filter -> buffer -> forward to cloud via HTTPS.
TODO: offline buffering (SQLite), simple edge anomaly check, retry with backoff."""
