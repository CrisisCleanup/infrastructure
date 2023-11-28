target "default" {
  dockerfile = "Dockerfile"
  tags = ["ghcr.io/crisiscleanup/runner:v2.311.0"]
  platforms = ["linux/arm64"]
}
