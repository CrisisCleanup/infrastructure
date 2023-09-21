target "default" {
  dockerfile = "Dockerfile"
  tags = ["ghcr.io/crisiscleanup/runner:v2.309.0"]
  platforms = ["linux/arm64"]
}
