# 小米减肥日记 —— 零依赖，所以镜像里连 node_modules 都没有
FROM node:22-alpine

WORKDIR /app

# 只拷运行需要的东西
COPY package.json ./
COPY server ./server
COPY public ./public

# 数据目录挂出来，容器重建也不丢
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

USER node
ENV PORT=4321 HOST=0.0.0.0
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:4321/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
