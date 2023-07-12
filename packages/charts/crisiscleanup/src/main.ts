import { App, Chart, type ChartProps } from 'cdk8s';
import * as kplus from 'cdk8s-plus-24';
import { ImagePullPolicy } from 'cdk8s-plus-24';
import { Construct } from 'constructs';


export interface DeploymentProps {
  replicaCount: number;
  image: string;
}


export interface CeleryQueueProps {
  name: string;
  args?: string[];
}

export interface CeleryProps extends DeploymentProps {
  queues?: CeleryQueueProps[];
}

export interface BackendProps {
  asgi: DeploymentProps;
  wsgi: DeploymentProps;
  celery: CeleryProps;
}

class BackendComponent<PropsT extends DeploymentProps=DeploymentProps> extends Construct {
  static componentName: string = '';
  deployment: kplus.Deployment;

  constructor(scope:Construct, id: string, readonly props: PropsT) {
    super(scope, id);
    const deploymentProps = this.createDeploymentProps();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const componentName = Object.getPrototypeOf(this).constructor.componentName as string;
    this.deployment = this.createDeployment('deployment', {
      metadata: {
        labels: {
          app: 'crisiscleanup',
          component: componentName,
        },
        ...(deploymentProps.metadata ?? {}),
      },
      spread: true,
      ...deploymentProps,
    });
  }


  protected createDeploymentProps(): kplus.DeploymentProps {
    return {};
  }


  protected createDeployment(id: string, props: kplus.DeploymentProps): kplus.Deployment {
    return new kplus.Deployment(this, id, props);
  }

  addContainer(props: Omit<kplus.ContainerProps, 'image'> & {image?: kplus.ContainerProps['image']; init?: boolean}): this {
    const defaults: kplus.ContainerProps = {
      image: this.props.image,
      imagePullPolicy: ImagePullPolicy.IF_NOT_PRESENT,
    };
    const { init = false, ...containerProps } = props;
    if (init) {
      this.deployment.addInitContainer({ ...defaults, ...containerProps });
    } else {
      this.deployment.addContainer({ ...defaults, ...containerProps });
    }
    return this;
  }

}


export class BackendWSGI extends BackendComponent {
  static componentName = 'wsgi';

  constructor(scope: Construct, id: string, props: DeploymentProps) {
    super(scope, id, props);
    this.addContainer({
      name: 'backend',
      ports: [{ number: 5000 }],
    }).addContainer({
      name: 'migrate',
      command: ['python', 'manage.py', 'migrate', '--noinput'],
      init: true,
    }).addContainer({
      name: 'collectstatic',
      command: ['python', 'manage.py', 'collectstatic', '--noinput'],
      init: true,
    });
  }
}

export class BackendASGI extends BackendComponent {
  static componentName = 'asgi';

  constructor(scope: Construct, id: string, props: DeploymentProps) {
    super(scope, id, props);
    this.addContainer(
      {
        name: 'backend',
        command: ['./serve.sh', 'asgi'],
        ports: [{ number: 5000 }],
      },
    );
  }
}

export class CeleryBeat extends BackendComponent {
  static componentName = 'celerybeat';

  constructor(scope: Construct, id: string, props: DeploymentProps) {
    super(scope, id, props);
    this.addContainer({
      name: 'celerybeat',
      command: ['./start-celerybeat.sh'],
    });
  }

  protected createDeploymentProps(): kplus.DeploymentProps {
    return { replicas: 1 };
  }

}

export class CeleryWorkers extends BackendComponent {
  static componentName = 'celeryworker';

  addWorkerQueue(queue: CeleryQueueProps): this {
    this.addContainer({
      name: queue.name,
      command: ['./start-celeryworker.sh', '-Q', queue.name, ...(queue.args??[])],
    });
    return this;
  }

}

export class Celery extends Construct {
  beat: CeleryBeat;
  workers: CeleryWorkers;

  constructor(scope: Construct, id: string, readonly props: CeleryProps) {
    super(scope, id);
    this.beat = new CeleryBeat(this, 'beat', props);
    this.workers = new CeleryWorkers(this, 'workers', props);
    if (props.queues) props.queues.forEach((queue) => this.workers.addWorkerQueue(queue));
  }
}

export class AdminWebSocket extends BackendComponent {
  static componentName = 'adminwebsocket';

  constructor(scope: Construct, id: string, props: DeploymentProps) {
    super(scope, id, props);
    this.addContainer({
      name: 'adminwebsocket',
      command: ['./start-adminwebsocket.sh'],
    });
  }
}

export class Backend extends Construct {
  wsgi: BackendWSGI;
  asgi: BackendASGI;
  celery: Celery;
  adminWebSocket: AdminWebSocket;

  constructor(scope: Construct, id: string, props: BackendProps) {
    super(scope, id);

    this.wsgi = new BackendWSGI(this, 'wsgi', props.wsgi);
    this.asgi = new BackendASGI(this, 'asgi', props.asgi);
    this.celery = new Celery(this, 'celery', props.celery);
    this.adminWebSocket = new AdminWebSocket(this, 'adminwebsocket', { ...props.wsgi, replicaCount: 1 });

  }
}


export class MyChart extends Chart {
  constructor(scope: Construct, id: string, props: ChartProps = { }) {
    super(scope, id, props);
    const image = '240937704012.dkr.ecr.us-east-1.amazonaws.com/crisiscleanup-api';
    new Backend(this, 'backend', {
      asgi: { replicaCount: 1, image },
      wsgi: { replicaCount: 1, image },
      celery: {
        image,
        replicaCount: 1,
        queues: [
          { name: 'default' },
          { name: 'phone' },
          { name: 'phone-metrics', args: ['--prefetch-multiplier=5'] },
        ],
      },
    });
  }
}

const app = new App();
new MyChart(app, 'crisiscleanup');
app.synth();
