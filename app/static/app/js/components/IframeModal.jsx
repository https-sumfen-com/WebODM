import React from 'react';
import PropTypes from 'prop-types';
import $ from 'jquery';
import { _ } from '../classes/gettext';
import '../../css/IframeModal.scss';

class IframeModal extends React.Component {
    static propTypes = {
        show: PropTypes.bool,
        onHide: PropTypes.func,
        title: PropTypes.string,
        url: PropTypes.string
    };

    static defaultProps = {
        show: false,
        title: _('View'),
        url: ''
    };

    constructor(props) {
        super(props);
        this.state = {
            showModal: props.show
        };
    }

    componentDidMount() {
        this._mounted = true;
        $(this.modal)
            .on('hidden.bs.modal', () => {
                this.hide();
            });
        this.componentDidUpdate();
    }

    componentWillUnmount() {
        this._mounted = false;
        $(this.modal).off('hidden.bs.modal').modal('hide');
    }

    componentDidUpdate(prevProps) {
        if (prevProps && prevProps.show !== this.props.show) {
            this.setState({ showModal: this.props.show });
        }
        
        if (this.state.showModal) {
            $(this.modal).modal('show');
        } else {
            $(this.modal).modal('hide');
        }
    }

    show = () => {
        this.setState({ showModal: true });
    }

    hide = () => {
        this.setState({ showModal: false });
        if (this.props.onHide) this.props.onHide();
    }

    setModal = (domNode) => {
        this.modal = domNode;
    }

    render() {
        return (
            <div
                ref={this.setModal}
                className="modal iframe-modal"
                tabIndex="-1"
                data-backdrop="static"
                style={{ display: 'none' }}
            >
                <div className="modal-dialog" style={{ width: '100%', height: '100%', margin: 0, maxWidth: 'none' }}>
                    <div className="modal-content" flex="dir:top" style={{ height: '100vh', border: 'none', borderRadius: 0 }}>
                        <div className="modal-header" flex-box="0">
                            <button type="button" className="close" onClick={this.hide}>
                                <span>&times;</span>
                            </button>
                            <h4 className="modal-title">{this.props.title}</h4>
                        </div>
                        <div className="modal-body" flex-box="1" style={{ maxHeight: '100vh' }}>
                            {this.props.url && (
                                <iframe
                                    src={this.props.url}
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        border: 'none'
                                    }}
                                    title={this.props.title}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export default IframeModal;