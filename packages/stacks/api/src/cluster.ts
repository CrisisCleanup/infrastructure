import * as blueprints from '@aws-quickstart/eks-blueprints'
import { Lazy } from 'aws-cdk-lib'
import type * as ec2 from 'aws-cdk-lib/aws-ec2'
import { KubernetesVersion } from 'aws-cdk-lib/aws-eks'
import { type ILayerVersion } from 'aws-cdk-lib/aws-lambda'
import { type EKSAddonConfig } from './schema'
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
	COMPUTE_TYPE = 'eks.amazonaws.com/compute-type',
}

export const buildSecretStoreAddon = () =>
	new blueprints.SecretsStoreAddOn({
		syncSecrets: true,
		values: {
			linux: {
				affinity: {
					nodeAffinity: {
						requiredDuringSchedulingIgnoredDuringExecution: {
							nodeSelectorTerms: [
								{
									// do not allow scheduling on fargate
									// (it does not support daemon sets)
									matchExpressions: [
										{
											key: Label.COMPUTE_TYPE,
											operator: 'NotIn',
											values: ['fargate'],
										},
									],
								},
							],
						},
					},
				},
			},
		},
	})

export const getDefaultAddons = (
	addonConfig: EKSAddonConfig,
): Array<blueprints.ClusterAddOn> => {
	// 	kubecostToken: apiStack.kubecostToken,
	// 	namespace: 'kubecost',
	// })
	return [
		buildSecretStoreAddon(),
		// kubecost,
		new blueprints.addons.AwsLoadBalancerControllerAddOn(),
		new blueprints.addons.EbsCsiDriverAddOn({
			version: addonConfig.ebsCsiVersion,
			kmsKeys: [blueprints.getNamedResource(ResourceNames.EBS_KEY)],
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
	addonConfig: EKSAddonConfig,
): Array<blueprints.ClusterAddOn> => {
	return [
		new blueprints.addons.MetricsServerAddOn(),
		new blueprints.addons.VpcCniAddOn({
			enablePrefixDelegation: true,
			version: addonConfig.vpcCniVersion,
		}),
		new blueprints.addons.CoreDnsAddOn({ version: addonConfig.coreDnsVersion }),
		new blueprints.addons.KubeProxyAddOn(addonConfig.kubeProxyVersion),
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

export const buildClusterBuilder = (
	k8sVersion: string,
): blueprints.ClusterBuilder => {
	const version = KubernetesVersion.of(k8sVersion)
	return blueprints.clusters
		.clusterBuilder()
		.withCommonOptions({
			version,
			kubectlLayer: blueprints.getNamedResource<ILayerVersion>(
				ResourceNames.KUBE_LAYER,
			),
			vpc: blueprints.getNamedResource<ec2.IVpc>(
				blueprints.GlobalResources.Vpc,
			),
		})
		.fargateProfile('serverless', {
			vpc: blueprints.getNamedResource<ec2.IVpc>(
				blueprints.GlobalResources.Vpc,
			),
			selectors: [{ namespace: 'karpenter' }, { namespace: 'cert-manager' }],
		})
}

export enum ResourceNames {
	DATABASE = 'database',
	DATABASE_SECRET = 'database-secret',
	DATABASE_KEY = 'database-key',
	EBS_KEY = 'ebs-key',
	KUBE_LAYER = 'kube-layer',
}
