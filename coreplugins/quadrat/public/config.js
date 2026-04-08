const isDev = false;

const DEV_CONFIG = {
  API_BASE: "http://192.168.3.249:7700",
  PROJECT_ID: 2,
  TASK_ID: "271ad056-716e-4a81-a75d-be6ba1904818",
};

const PROD_CONFIG = {
  API_BASE: null,
  PROJECT_ID: null,
  TASK_ID: null,
};

const config = isDev ? DEV_CONFIG : PROD_CONFIG;

export default config;
export { isDev, DEV_CONFIG, PROD_CONFIG };
