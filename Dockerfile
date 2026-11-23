# AHIP Manage (dashboard + accounts + forms designer + AI). Plain Node.js, no npm packages.
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=8090 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
EXPOSE 8090
USER node
CMD ["node", "server.js"]
