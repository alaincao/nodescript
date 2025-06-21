FROM debian:latest

## Install packages
ENV DEBIAN_FRONTEND noninteractive
RUN set -ex \
 && apt-get update \
 && : "Install base packages" \
 && apt-get install -y \
		apt-transport-https \
		apt-utils \
		aptitude \
		bash-completion \
		build-essential \
		curl \
		file \
		git \
		gitk \
		iputils-ping \
		less \
		lsb-release \
		ncdu \
		net-tools \
		netcat-openbsd \
		openssh-client \
		procps \
		psmisc \
		sl \
		sudo \
		tree \
		vim \
		wget \
 && : "Done"

# Setups as user 'root'
ARG TEST_USER_NAME
ARG TEST_USER_ID
RUN set -ex \
 && : "Create user ${TEST_USER_NAME:?TEST_USER_NAME not set}" \
 && addgroup --gid "${TEST_USER_ID:?TEST_USER_ID not set}" "${TEST_USER_NAME}" \
 && adduser --disabled-password --gecos "" --uid "${TEST_USER_ID}" --gid "${TEST_USER_ID}" "${TEST_USER_NAME}" \
 && adduser "${TEST_USER_NAME}" dialout \
 && : "Setup sudo" \
 && echo "${TEST_USER_NAME} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
 && : "Create startup script" \
 && echo "#!/bin/sh" > /start.sh \
 && echo "set -ex" >> /start.sh \
 && echo "env | sort" >> /start.sh \
 && echo "trap 'true' TERM" >> /start.sh \
 && echo "sleep infinity &" >> /start.sh \
 && echo "wait \$!" >> /start.sh \
 && chmod +x /start.sh \
 && : "Done"
CMD [ "/start.sh" ]

ARG TEST_DOCKER_GID
RUN set -ex \
 && : "Install docker CLI" \
 && curl -fsSL https://download.docker.com/linux/debian/gpg | apt-key add - \
 && echo "deb [arch=amd64] https://download.docker.com/linux/debian $(lsb_release -cs) stable" >> /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y docker-ce-cli \
 && addgroup --gid ${TEST_DOCKER_GID:?TEST_DOCKER_GID not set} docker \
 && adduser "${TEST_USER_NAME}" docker \
 && : "Done"

RUN set -ex \
 && : "Install additional packages" \
 && apt-get install -y \
		btrfs-compsize \
		btrfs-heatmap \
		btrfs-progs \
		hdparm \
 && : "Done"

# Setups as user '${TEST_USER_NAME}'
ARG TEST_GIT_NAME
ARG TEST_GIT_EMAIL
USER ${TEST_USER_NAME}
COPY ./bashrc ./bashrc
RUN set -ex \
 && : "Tweaks" \
 && mkdir ~/.ssh \
 && git config --global core.editor "code --wait" \
 && git config --global user.name "${TEST_GIT_NAME:?TEST_GIT_NAME not set}" \
 && git config --global user.email "${TEST_GIT_EMAIL:?TEST_GIT_EMAIL not set}" \
 && : "Create user directories" \
 && mkdir ~/bin \
 && mkdir ~/works \
 && : "Update ~/.bashrc" \
 && cat bashrc >> ~/.bashrc \
 && sudo rm bashrc \
 && : "Done"
WORKDIR /home/${TEST_USER_NAME}/works/

RUN set -ex \
 && : "Install nvm" \
 && curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash \
 && : "Install node & npm" \
 && bash -c "source ~/.nvm/nvm.sh && nvm install --lts" \
 && : "Done"
ENV PATH="${PATH}:/home/${TEST_USER_NAME}/works:/home/${TEST_USER_NAME}/works/node_modules/.bin"
