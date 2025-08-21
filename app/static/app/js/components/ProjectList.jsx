import React from 'react';
import $ from 'jquery';
import '../css/ProjectList.scss';

import ProjectListItem from './ProjectListItem';
import Paginated from './Paginated';
import Paginator from './Paginator';
import ErrorMessage from './ErrorMessage';
import { _, interpolate } from '../classes/gettext';
import PropTypes from 'prop-types';
import Utils from '../classes/Utils';

class ProjectList extends Paginated {
    static propTypes = {
        history: PropTypes.object.isRequired,
    }

    constructor(props) {
        super(props);

        this.state = {
            loading: true,
            refreshing: false,
            error: "",
            projects: [],
            activeProjectId: null // 当前选中的项目ID
        }

        this.PROJECTS_PER_PAGE = 10;

        this.handleDelete = this.handleDelete.bind(this);
    }

    componentDidMount() {
        this.refresh();
    }

    getParametersHash(source) {
        if (!source) return "";
        if (source.indexOf("?") === -1) return "";

        let search = source.substr(source.indexOf("?"));
        let q = Utils.queryParams({ search });

        // All parameters that can change via history.push without
        // triggering a reload of the project list should go here
        delete q.project_task_open;
        delete q.project_task_expanded;

        return JSON.stringify(q);
    }

    componentDidUpdate(prevProps) {
        if (this.getParametersHash(prevProps.source) !== this.getParametersHash(this.props.source)) {
            this.refresh();
        }
    }

    refresh() {
        this.setState({ refreshing: true });

        // Load projects from API
        this.serverRequest =
            $.getJSON(this.props.source, json => {
                if (json.results) {
                    this.setState({
                        projects: json.results,
                        loading: false
                    });
                    this.updatePagination(this.PROJECTS_PER_PAGE, json.count);
                } else {
                    this.setState({
                        error: interpolate(_("Invalid JSON response: %(error)s"), { error: JSON.stringify(json) }),
                        loading: false
                    });
                }
            })
                .fail((jqXHR, textStatus, errorThrown) => {
                    this.setState({
                        error: interpolate(_("Could not load projects list: %(error)s"), { error: textStatus }),
                        loading: false
                    });
                })
                .always(() => {
                    this.setState({ refreshing: false });
                });
    }

    onPageChanged(pageNum) {
        this.refresh();
    }

    componentWillUnmount() {
        this.serverRequest.abort();
    }

    handleDelete(projectId) {
        let projects = this.state.projects.filter(p => p.id !== projectId);
        this.setState({ projects: projects });
        this.handlePageItemsNumChange(-1, () => {
            this.refresh();
        });
    }

    handleTaskMoved = (task) => {
        if (this["projectListItem_" + task.project]) {
            this["projectListItem_" + task.project].newTaskAdded();
        }
    }

    handleProjectDuplicated = () => {
        this.refresh();
    }

    setActiveProject = (projectId) => {
        this.setState({ activeProjectId: projectId });
    }

    render() {
        if (this.state.loading) {
            return (<div className="project-list text-center"><i className="fa fa-circle-notch fa-spin fa-2x fa-fw"></i></div>);
        } else {
            const { projects, activeProjectId } = this.state;

            return (<div className="project-list">
                <ErrorMessage bind={[this, 'error']} />



                <Paginator {...this.state.pagination} {...this.props} onRefresh={() => this.refresh()}>
                    {/* 项目Tab栏 */}
                    {projects.length > 0 && (
                        <div className="project-tabs">
                            <ul className="nav nav-tabs">
                                <li className={activeProjectId === null ? "active" : ""}>
                                    <a href="javascript:void(0);" onClick={() => this.setActiveProject(null)}>
                                        {_("全部项目")} ({projects.length})
                                    </a>
                                </li>
                                {projects.map(project => (
                                    <li key={project.id} className={activeProjectId === project.id ? "active" : ""}>
                                        <a href="javascript:void(0);" onClick={() => this.setActiveProject(project.id)}>
                                            {project.name} ({project.tasks ? project.tasks.length : 0})
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <ul key="1" className={"list-group project-list " + (this.state.refreshing ? "refreshing" : "")}>
                        {projects
                             .filter(p => activeProjectId === null || p.id === activeProjectId)
                             .map(p => (
                                 <ProjectListItem 
                                     ref={(domNode) => { this["projectListItem_" + p.id] = domNode }}
                                     key={p.id} 
                                     data={p} 
                                     onDelete={this.handleDelete}
                                     onTaskMoved={this.handleTaskMoved}
                                     onProjectDuplicated={this.handleProjectDuplicated}
                                     history={this.props.history}
                                     defaultShowTaskList={activeProjectId !== null} /> 
                             ))}
                    </ul>
                </Paginator>
            </div>);
        }
    }
}

export default ProjectList;
