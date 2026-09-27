from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Mellox GEO Intelligence"
    app_env: str = "development"
    database_url: str = "sqlite:///./mellox.db"
    api_v1_prefix: str = "/api/v1"


settings = Settings()