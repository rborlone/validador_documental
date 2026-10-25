{{- /*
Monta secretos de Azure Key Vault con el CSI driver y los sincroniza como Secret de Kubernetes,
para consumirlos con secretEnv. Autentica con Workload Identity (sin credenciales en el chart).
*/ -}}
{{- define "vd.secretproviderclass" -}}
{{- if .Values.secretsStore.enabled }}
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: {{ include "vd.fullname" . }}
  labels: {{- include "vd.labels" . | nindent 4 }}
spec:
  provider: azure
  parameters:
    usePodIdentity: "false"
    clientID: {{ .Values.workloadIdentity.clientId | quote }}
    keyvaultName: {{ .Values.secretsStore.keyVaultName | quote }}
    tenantId: {{ .Values.secretsStore.tenantId | quote }}
    objects: |
      array:
        {{- range .Values.secretsStore.objects }}
        - |
          objectName: {{ .keyVaultSecret }}
          objectType: secret
        {{- end }}
  secretObjects:
    - secretName: {{ .Values.secretsStore.secretName }}
      type: Opaque
      data:
        {{- range .Values.secretsStore.objects }}
        - objectName: {{ .keyVaultSecret }}
          key: {{ .key }}
        {{- end }}
{{- end }}
{{- end -}}
