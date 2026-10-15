# Viviz Cloud Cost Planner

A browser-based AWS architecture and illustrative cost planner. All calculations run locally in the browser using fictional planning rates; no AWS credentials, live pricing API, backend, or database are required.

## Deploy with Coolify

Use the `main` branch, Dockerfile build pack, base directory `/`, Dockerfile `/Dockerfile`, and container port `8080`. Set the domain to `https://aws.viviz.in` and point its DNS A record to the application server.

The image serves the four application assets with unprivileged Nginx and includes an HTTP health check. No build commands or environment variables are needed.
