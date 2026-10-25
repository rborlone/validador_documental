{{- define "vd.deployment" -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "vd.fullname" . }}
  labels: {{- include "vd.labels" . | nindent 4 }}
spec:
  {{- if not (or .Values.autoscaling.enabled .Values.keda.enabled) }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
  selector:
    matchLabels: {{- include "vd.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "vd.selectorLabels" . | nindent 8 }}
        {{- if and .Values.workloadIdentity .Values.workloadIdentity.clientId }}
        azure.workload.identity/use: "true"
        {{- end }}
      annotations:
        checksum/config: {{ toJson .Values.env | sha256sum }}
        {{- if .Values.metrics.enabled }}
        prometheus.io/scrape: "true"
        prometheus.io/port: {{ .Values.metrics.port | quote }}
        prometheus.io/path: {{ .Values.metrics.path | quote }}
        {{- end }}
    spec:
      serviceAccountName: {{ include "vd.fullname" . }}
      terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds }}
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels: {{- include "vd.selectorLabels" . | nindent 14 }}
      containers:
        - name: {{ include "vd.name" . }}
          image: {{ include "vd.image" . }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: {{ .Values.readOnlyRootFilesystem }}
            capabilities: { drop: ["ALL"] }
          {{- with .Values.containerPort }}
          ports:
            - name: http
              containerPort: {{ . }}
          {{- end }}
          env:
            {{- range $k, $v := .Values.env }}
            - name: {{ $k }}
              value: {{ $v | quote }}
            {{- end }}
            {{- range .Values.secretEnv }}
            - name: {{ .name }}
              valueFrom:
                secretKeyRef: { name: {{ .secretName }}, key: {{ .key }} }
            {{- end }}
          {{- with .Values.probes }}
          livenessProbe:
            httpGet: { path: {{ .livePath }}, port: {{ .port }} }
            periodSeconds: 15
            failureThreshold: 3
          readinessProbe:
            httpGet: { path: {{ .readyPath }}, port: {{ .port }} }
            periodSeconds: 10
            failureThreshold: 3
          startupProbe:
            httpGet: { path: {{ .livePath }}, port: {{ .port }} }
            periodSeconds: 5
            failureThreshold: 30
          {{- end }}
          resources: {{- toYaml .Values.resources | nindent 12 }}
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
            {{- if .Values.secretsStore.enabled }}
            - { name: secrets-store, mountPath: /mnt/secrets-store, readOnly: true }
            {{- end }}
      volumes:
        - name: tmp
          emptyDir: {}
        {{- if .Values.secretsStore.enabled }}
        - name: secrets-store
          csi:
            driver: secrets-store.csi.k8s.io
            readOnly: true
            volumeAttributes:
              secretProviderClass: {{ include "vd.fullname" . }}
        {{- end }}
      {{- with .Values.nodeSelector }}
      nodeSelector: {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations: {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end -}}
