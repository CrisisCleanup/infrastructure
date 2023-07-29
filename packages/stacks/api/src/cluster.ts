import * as blueprints from '@aws-quickstart/eks-blueprints'
import { type CrisisCleanupConfig } from '@crisiscleanup/config'
import type * as ec2 from 'aws-cdk-lib/aws-ec2'
import { KubernetesVersion } from 'aws-cdk-lib/aws-eks'
import { KubectlLayer } from 'aws-cdk-lib/lambda-layer-kubectl'

enum Label {
	INSTANCE_TYPE = 'node.kubernetes.io/instance-type',
	TOPO_ZONE = 'topology.kubernetes.io/zone',
	ARCH = 'kubernetes.io/arch',
	CAPACITY_TYPE = 'karpenter.sh/capacity-type',
	KARPENTER_DISCOVERY = 'karpenter.sh/discovery',
	CLUSTER_DISCOVERY = 'kubernetes.io/cluster',
}

const defaultAddons: Array<blueprints.ClusterAddOn> = [
	// new blueprints.addons.ArgoCDAddOn(),
	// -- support k8s network policies
	// new blueprints.addons.CalicoOperatorAddOn(),
	// new blueprints.addons.ContainerInsightsAddOn(),
]

export const getDefaultAddons = (
	config: CrisisCleanupConfig,
): Array<blueprints.ClusterAddOn> => {
	const { apiStack } = config
	const { eks } = apiStack
	return [
		new blueprints.addons.MetricsServerAddOn(),
		new blueprints.addons.AwsLoadBalancerControllerAddOn(),
		new blueprints.addons.VpcCniAddOn({
			enablePrefixDelegation: true,
			version: eks.vpcCniVersion,
		}),
		new blueprints.addons.CoreDnsAddOn(eks.coreDnsVersion),
		new blueprints.addons.KubeProxyAddOn(eks.kubeProxyVersion),
	]
}

export const tagKarpenter = (stack: blueprints.EksBlueprint) => {
	const clusterInfo = stack.getClusterInfo()
	const vpc = clusterInfo.getResource<ec2.IVpc>(blueprints.GlobalResources.Vpc)!
	const discoveryTag = `${Label.KARPENTER_DISCOVERY}/${clusterInfo.cluster.clusterName}`
	blueprints.utils.tagSubnets(stack, vpc.privateSubnets, discoveryTag, '*')
}

export const buildKarpenter = (stackName: string, subnetNames: string[]) => {
	const clusterDiscoveryTag = `${Label.CLUSTER_DISCOVERY}/${stackName}`
	return new blueprints.KarpenterAddOn({
		version: 'v0.29.2',
		requirements: [
			{ key: Label.ARCH, op: 'In', vals: ['arm64'] },
			{ key: Label.CAPACITY_TYPE, op: 'In', vals: ['spot', 'on-demand'] },
		],
		subnetTags: {
			Name: subnetNames.join(','),
		},
		securityGroupTags: {
			[clusterDiscoveryTag]: 'owned',
		},
		amiFamily: 'AL2',
		consolidation: { enabled: true },
		interruptionHandling: true,
		namespace: 'karpenter',
		// refresh nodes at least every 30 days
		ttlSecondsUntilExpired: 2592000,
		// limits: {
		//   resources: {
		//     cpu: 10,
		//     memory: '200Gi',
		//   }
		// }
	})
}

export const buildEKSStack = (
	config: CrisisCleanupConfig,
): blueprints.BlueprintBuilder => {
	const { apiStack, cdkEnvironment } = config
	if (!apiStack) throw Error('No apistack config found.')
	return blueprints.EksBlueprint.builder()
		.account(String(cdkEnvironment.account))
		.region(cdkEnvironment.region)
		.version(KubernetesVersion.of(apiStack.eks.k8s.version))
		.addOns(...defaultAddons)
		.useDefaultSecretEncryption(apiStack.eks.defaultSecretsEncryption)
}

export const buildClusterBuilder = (
	config: CrisisCleanupConfig,
): blueprints.ClusterBuilder => {
	return blueprints.clusters
		.clusterBuilder()
		.withCommonOptions({
			version: KubernetesVersion.of(config.apiStack.eks.k8s.version),
		})
		.fargateProfile('serverless', { selectors: [{ namespace: 'karpenter' }] })
}
