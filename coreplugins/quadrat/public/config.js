const isDev = true

const DEV_CONFIG = {
  API_BASE: 'http://192.168.3.249:7700',
  PROJECT_ID: 1,
  TASK_ID: 'c65bdde1-ba45-4675-a3e1-15d4d691e38d'
}

const PROD_CONFIG = {
  API_BASE: null,
  PROJECT_ID: null,
  TASK_ID: null
}

const config = isDev ? DEV_CONFIG : PROD_CONFIG

export default config
export { isDev, DEV_CONFIG, PROD_CONFIG }