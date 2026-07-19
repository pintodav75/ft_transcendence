COMPOSE_FILE	= docker-compose.yml

include .env

.PHONY: all up down clean fclean re logs ps

# -d is for detached mode
all:
	mkdir -p $(DATA_PATH)/mariadb $(DATA_PATH)/wordpress
	docker compose -f $(COMPOSE_FILE) up -d --build

# -f to supply the configuration file
# -d is for detached
up:
	docker compose -f $(COMPOSE_FILE) up -d

down:
	docker compose -f $(COMPOSE_FILE) down

# also removes builds (images)
clean: down
	docker compose -f $(COMPOSE_FILE) down --rmi all

# also remove data files
fclean: clean
	sudo rm -rf $(DATA_PATH)/mariadb $(DATA_PATH)/wordpress

re: fclean all

logs:
	docker compose -f $(COMPOSE_FILE) logs

ps:
	docker compose -f $(COMPOSE_FILE) ps -a
# you need the -a because by default it doesnt show exited containers

stop:
	docker compose -f $(COMPOSE_FILE) stop

all dev:
	mkdir -p $(DATA_PATH)/mariadb $(DATA_PATH)/wordpress
	docker compose -f $(COMPOSE_FILE) up -d --build
	docker compose exec backend npm run seed:dev
# docker compose up -d --build