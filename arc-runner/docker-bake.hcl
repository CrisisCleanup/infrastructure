target "default" {
  dockerfile = "Dockerfile"
  tags = ["ghcr.io/crisiscleanup/runner:v2.321.0"]
  platforms = ["linux/arm64"]
}
