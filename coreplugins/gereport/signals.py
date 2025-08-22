import logging
import os

import requests
from django.dispatch import receiver
from app.plugins.signals import task_completed, task_failed, task_removed
from app.plugins.functions import get_current_plugin
from . import config
from app.models import Task, Setting

logger = logging.getLogger('app.logger')
WO_PORT = os.environ.get('WO_PORT', '8000')
WO_HOST = os.environ.get('WO_HOST', 'localhost')
WO_SCHEMA = "https" if os.environ.get('WO_SSL', 'NO') == "YES" else "http"
ODM_HOST = f"{WO_SCHEMA}://{WO_HOST}:{WO_PORT}"

@receiver(task_completed)
def handle_task_completed(sender, task_id, **kwargs):
    if get_current_plugin(only_active=True) is None:
        return

    logger.info("Generate Report: Task Completed")
    config_data = config.load()

    task = Task.objects.get(id=task_id)
    orth_tif_path = task.ASSETS_MAP['orthophoto.tif']

    logger.info("Orthophoto path: %s", orth_tif_path)
    logger.info("generate_report_url: %s", config_data.get("callback_url"))
    logger.info("project_id: %d, task_id: %s", task.project.id, task.id)
    # Generate report code here
    try:
        res = requests.post(
            url=config_data.get("callback_url"),
            json={
                "project_id": task.project.id,
                "task_id": str(task.id),
                "orthophoto_tif": orth_tif_path,
                # "odm_host": ODM_HOST,
                # "odm_job_name": task.name
            }, timeout=(2, 3)
        )

        logger.info("Report sent successfully, http status code:%d", res.status_code)
    except requests.exceptions.RequestException as e:
        logger.error("Failed to send report to server: %s", e)
    except Exception as e:
        logger.error("Failed to generate report: %s", e)
    finally:
        logger.info("Report generation completed, ODM host: %s", ODM_HOST)

