# Railway 배포용 Dockerfile
# Node.js 서버로 정적 파일 서빙 + API 프록시 (curl 역할)

FROM node:20-alpine

WORKDIR /app

# package.json 복사 및 의존성 설치
COPY package-server.json package.json
RUN npm install --production

# 서버 및 정적 파일 복사
COPY server.js .
COPY player/ ./player/

# Railway는 PORT 환경변수 사용
EXPOSE 8080

CMD ["node", "server.js"]
