import { KubectlV27Layer } from '@aws-cdk/lambda-layer-kubectl-v27'
import * as blueprints from '@aws-quickstart/eks-blueprints'
import { type CrisisCleanupConfig } from '@crisiscleanup/config'
import { KubecostAddOn } from '@kubecost/kubecost-eks-blueprints-addon'
import { Lazy } from 'aws-cdk-lib'
import type * as ec2 from 'aws-cdk-lib/aws-ec2'
import { KubernetesVersion } from 'aws-cdk-lib/aws-eks'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as kms from 'aws-cdk-lib/aws-kms'
import { lazyClusterInfo } from './util'

enum Label {
	INSTANCE_TYPE = 'node.kubernetes.io/instance-type',
	TOPO_ZONE = 'topology.kubernetes.io/zone',
	ARCH = 'kubernetes.io/arch',
	CAPACITY_TYPE = 'karpenter.sh/capacity-type',
	KARPENTER_DISCOVERY = 'karpenter.sh/discovery',
	CLUSTER_DISCOVERY = 'kubernetes.io/cluster',
	INSTANCE_CATEGORY = 'karpenter.k8s.aws/instance-category',
	INSTANCE_HYPERVISOR = 'karpenter.k8s.aws/instance-hypervisor',
}

export const getDefaultAddons = (
	config: CrisisCleanupConfig,
): Array<blueprints.ClusterAddOn> => {
	const { apiStack } = config
	const { eks } = apiStack
	const kubecost = new KubecostAddOn({
		kubecostToken: apiStack.kubecostToken,
		namespace: 'kubecost',
	})
	return [
		new blueprints.SecretsStoreAddOn({ syncSecrets: true }),
		kubecost,
		new blueprints.addons.AwsLoadBalancerControllerAddOn(),
		new blueprints.addons.EbsCsiDriverAddOn({
			version: eks.ebsCsiVersion,
			kmsKeys: [
				blueprints.getResource(
					(context) =>
						new kms.Key(context.scope, 'ebs-csi-driver-key', {
							alias: 'ebs-csi-driver-key',
						}),
				),
			],
		}),
		new blueprints.addons.CertManagerAddOn({
			values: {
				webhook: {
					securePort: 10260,
				},
			},
		}),
	]
}

export const getCoreAddons = (
	config: CrisisCleanupConfig,
): Array<blueprints.ClusterAddOn> => {
	const { apiStack } = config
	const { eks } = apiStack
	return [
		new blueprints.addons.MetricsServerAddOn(),
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

/**
 * Karpenter addon
 * @param clusterName Cluster name to target. Defaults to lazy lookup.
 * @param subnetNames Subnet names to target. Defaults to lazy lookup.
 */
export const buildKarpenter = (clusterName?: string, subnetNames?: string) => {
	const sgTag =
		clusterName ??
		Lazy.uncachedString(
			lazyClusterInfo(
				(clusterInfo) =>
					`${Label.CLUSTER_DISCOVERY}/${clusterInfo.cluster.clusterName}`,
			),
		)

	const subnetTags =
		subnetNames ??
		Lazy.uncachedString(
			lazyClusterInfo((clusterInfo) =>
				clusterInfo.cluster.vpc.privateSubnets
					.map((sn) => sn.node.path)
					.join(','),
			),
		)

	return new blueprints.KarpenterAddOn({
		version: 'v0.29.2',
		requirements: [
			{ key: Label.ARCH, op: 'In', vals: ['arm64'] },
			{ key: Label.CAPACITY_TYPE, op: 'In', vals: ['spot', 'on-demand'] },
			{ key: Label.INSTANCE_CATEGORY, op: 'In', vals: ['c', 'm', 'r', 't'] },
			{ key: Label.INSTANCE_HYPERVISOR, op: 'In', vals: ['nitro'] },
		],
		subnetTags: {
			Name: subnetTags,
		},
		securityGroupTags: {
			[sgTag]: 'owned',
		},
		amiFamily: 'AL2',
		consolidation: { enabled: true },
		interruptionHandling: true,
		namespace: 'karpenter',
		values: {
			settings: {
				aws: {
					// informs karpenter to expect prefix delegation.
					enableENILimitedPodDensity: false,
				},
			},
		},
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
	const { apiStack } = config
	if (!apiStack) throw Error('No apistack config found.')
	return blueprints.EksBlueprint.builder()
		.version(KubernetesVersion.of(apiStack.eks.k8s.version))
		.addOns(...getCoreAddons(config))
		.useDefaultSecretEncryption(apiStack.eks.defaultSecretsEncryption)
}

export const buildClusterBuilder = (
	config: CrisisCleanupConfig,
): blueprints.ClusterBuilder => {
	const k8sVersion = KubernetesVersion.of(config.apiStack.eks.k8s.version)
	return blueprints.clusters
		.clusterBuilder()
		.withCommonOptions({
			clusterName: 'crisiscleanup',
			version: k8sVersion,
			kubectlLayer: blueprints.getResource(
				(context) => new KubectlV27Layer(context.scope, 'kubectllayer24'),
			),
		})
		.fargateProfile('serverless', {
			selectors: [{ namespace: 'karpenter' }, { namespace: 'cert-manager' }],
		})
}
