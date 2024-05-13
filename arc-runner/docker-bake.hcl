target "default" {
  dockerfile = "Dockerfile"
  tags = ["ghcr.io/crisiscleanup/runner:v2.316.1"]
  platforms = ["linux/arm64"]
}
