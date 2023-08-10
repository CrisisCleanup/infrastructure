# CrisisCleanup Infrastructure

Projen powered IaC for CrisisCleanup.

## Stacks

### Overview

Collapsed overview of a single stage.

<img src=".github/img/stacks-api-development-overview.png" align="center"  />

A more in-depth overview of a single stage.

<img src=".github/img/stacks-api-development-detailed.png" align="center"  />

## Charts

### CrisisCleanup

<img src=".github/img/charts-crisiscleanup.png" align="center"  />

```mermaid
graph LR
    subgraph Ingress
        A[crisiscleanup-ingress]
    end
    subgraph Services
        B[crisiscleanup-wsgi-service]
        C[crisiscleanup-asgi-service]
        D[crisiscleanup-frontend-web-service]
    end
    subgraph Deployments
        E[crisiscleanup-wsgi]
        F[crisiscleanup-asgi]
        G[crisiscleanup-frontend-web]
        M[crisiscleanup-celerybeat]
        N[crisiscleanup-celery-celery]
        P[crisiscleanup-celery-phone]
        R[crisiscleanup-celery-signal]
        T[crisiscleanup-celery-metrics]
        V[Job: crisiscleanup-wsgi-migrate]
        W[Job: crisiscleanup-wsgi-collectstatic]
    end
    subgraph Configurations
        K[ConfigMap: crisiscleanup-api-config-config]
        L[Secret: crisiscleanup-api-config-config-secret]
    end
    subgraph Autoscalers
        H[HPA: crisiscleanup-wsgi-hpa]
        I[HPA: crisiscleanup-asgi-hpa]
        J[HPA: crisiscleanup-frontend-web-hpa]
        O[HPA: crisiscleanup-celery-celery-hpa]
        Q[HPA: crisiscleanup-celery-phone-hpa]
        S[HPA: crisiscleanup-celery-signal-hpa]
        U[HPA: crisiscleanup-celery-metrics-hpa]
    end
    A -->|Route: api.*/| B
    A -->|Route: api.*/ws/| C
    A -->|Route: /| D
    B --> E
    C --> F
    D --> G
    E --> H
    F --> I
    G --> J
    E --> K
    E --> L
    F --> K
    F --> L
    G --> K
    G --> L
    M --> K
    M --> L
    N --> K
    N --> L
    N --> O
    P --> K
    P --> L
    P --> Q
    R --> K
    R --> L
    R --> S
    T --> K
    T --> L
    T --> U
    V --> K
    V --> L
    W --> K
    W --> L
```
