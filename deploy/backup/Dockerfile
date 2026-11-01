# The nightly backup job: pg_dump, then rclone to R2. FROM the same pinned
# image as the postgres service in ../compose.yml, so pg_dump always matches the
# server's major version (the test, deploy/test/backup/run.sh, checks both pins agree).
FROM docker.io/library/postgres:18.6

# rclone must know the "Cloudflare" S3 provider (RCLONE_CONFIG_R2_PROVIDER).
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl rclone \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --system --uid 10001 --create-home --shell /usr/sbin/nologin backupjob

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod 755 /usr/local/bin/backup.sh

USER backupjob
WORKDIR /home/backupjob

# Replaces the postgres image's entrypoint (and its default command): this image runs the job only.
ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD []
