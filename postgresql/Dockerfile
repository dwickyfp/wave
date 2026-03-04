FROM pgvector/pgvector:pg16

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
    postgresql-16-cron \
    postgresql-server-dev-16 \
    libcurl4-openssl-dev \
    build-essential \
    git \
    ca-certificates; \
    rm -rf /var/lib/apt/lists/*;

RUN echo "shared_preload_libraries = 'pg_cron'" >> /usr/share/postgresql/postgresql.conf.sample

# Force the correct PG_CONFIG so make finds PG 16 headers
RUN git clone https://github.com/pramsey/pgsql-http.git /tmp/http \
    && cd /tmp/http \
    && make PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config \
    && make PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config install \
    && rm -rf /tmp/http

# Clean up (same as before)
RUN apt-get purge -y --auto-remove \
    postgresql-server-dev-16 \
    libcurl4-openssl-dev \
    build-essential \
    git \
    && apt-get autoremove -y && apt-get clean