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
ARG USER_NAME
ARG USER_ID=1000
RUN set -ex \
 && : "Create user ${USER_NAME}" \
 && addgroup --gid "${USER_ID}" "${USER_NAME}" \
 && adduser --disabled-password --gecos "" --uid "${USER_ID}" --gid "${USER_ID}" "${USER_NAME}" \
 && adduser "${USER_NAME}" dialout \
 && : "Setup sudo" \
 && echo "${USER_NAME} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
 && : "Create startup script" \
 && echo "#!/bin/sh" > /start.sh \
 && echo "set -ex" >> /start.sh \
 && echo "env | sort" >> /start.sh \
 && echo "sleep infinity" >> /start.sh \
 && chmod +x /start.sh \
 && : "Done"
CMD [ "/start.sh" ]

# Setups as user '${USER_NAME}'
USER ${USER_NAME}
COPY ./bashrc ./
RUN set -ex \
 && : "Tweaks" \
 && mkdir ~/.ssh \
 && git config --global core.editor "code --wait" \
 && git config --global user.name "Alain CAO" \
 && git config --global user.email "alaincao17@gmail.com" \
 && : "Create user directories" \
 && mkdir ~/bin \
 && mkdir ~/works \
 && : "Update ~/.bashrc" \
 && cat bashrc >> ~/.bashrc \
 && sudo rm bashrc \
 && : "Done"
WORKDIR /home/${USER_NAME}/works/
