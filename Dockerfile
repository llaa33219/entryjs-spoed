# Railway 배포용 Dockerfile
# nginx를 사용하여 정적 파일 서빙

FROM nginx:alpine

# nginx 설정 복사
COPY nginx.conf /etc/nginx/nginx.conf

# player 디렉토리의 정적 파일 복사
COPY player/ /usr/share/nginx/html/

# Railway는 PORT 환경변수를 사용
# nginx 설정에서 이를 동적으로 처리
EXPOSE 80

# 시작 시 PORT 환경변수로 nginx 포트 설정
CMD sh -c "sed -i 's/listen 80/listen ${PORT:-80}/g' /etc/nginx/nginx.conf && nginx -g 'daemon off;'"
