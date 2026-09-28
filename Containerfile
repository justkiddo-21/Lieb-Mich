# Static build of the browser preview, served by unprivileged nginx.
# Build from the repo root: the app pulls in ../audio and ../data.
FROM docker.io/oven/bun:1 AS build
WORKDIR /src/app
COPY app/package.json app/bun.lock ./
RUN bun install --frozen-lockfile
COPY audio /src/audio
COPY data /src/data
COPY app /src/app
RUN bunx vite build

FROM docker.io/nginxinc/nginx-unprivileged:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/app/dist /usr/share/nginx/html
EXPOSE 8080
