// eslint-disable-next-line import/no-extraneous-dependencies
import 'zx/globals'

$.verbose = true

const ECR_REGISTRY = '240937704012.dkr.ecr.us-east-1.amazonaws.com'
enum ECRRepository {
	API = 'crisiscleanup-api',
	WEB = 'crisiscleanup-web',
}

interface Image {
	repository: ECRRepository
	tag?: string
	registry?: string
}

const createKindCluster = async () => {
	echo('Creating kind cluster...')
	await $`cat <<EOF | kind create cluster --config=-
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  kubeadmConfigPatches:
  - |
    kind: InitConfiguration
    nodeRegistration:
      kubeletExtraArgs:
        node-labels: "ingress-ready=true"
  extraPortMappings:
  - containerPort: 80
    hostPort: 80
    protocol: TCP
  - containerPort: 443
    hostPort: 443
    protocol: TCP
EOF`
}

const imageFqn = ({
	repository,
	tag = 'latest',
	registry = ECR_REGISTRY,
}: Image) => `${registry}/${repository}:${tag}`

const authEcr = async () =>
	$`aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ${ECR_REGISTRY}`

const tagImage = async (source: Image, dest: Image) =>
	$`docker tag ${imageFqn(source)} ${imageFqn(dest)}`

const pullImage = async (
	image: Image,
	options: { authOnFail: boolean } = { authOnFail: true },
) =>
	$`docker pull ${imageFqn(image)}`.catch(async (err) => {
		echo(err)
		if (!options.authOnFail) throw err
		echo('Authenticating to ECR...')
		await authEcr()
		await pullImage(image, { authOnFail: false })
	})

const loadKindImage = async (image: Image) =>
	$`kind load docker-image ${imageFqn(image)}`

const createLocalCluster = async () => {
	echo('Creating local cluster using kind...')
	const images: Image[] = [
		{ repository: ECRRepository.API, tag: 'development' },
		{ repository: ECRRepository.WEB, tag: 'development' },
	]
	const pullAndTag = async (image: Image) =>
		pullImage(image).then(() => tagImage(image, { ...image, tag: 'latest' }))
	await Promise.all([
		createKindCluster(),
		// ...images.map((img) => pullAndTag(img)),
	])
	echo('Importing images into kind...')
	await Promise.all(
		images.map((img) => loadKindImage({ ...img, tag: 'latest' })),
	)
	echo('Ready!')
}

await createLocalCluster()
