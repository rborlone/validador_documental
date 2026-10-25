{{- define "vd.service" -}}
{{- if .Values.containerPort }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "vd.fullname" . }}
  labels: {{- include "vd.labels" . | nindent 4 }}
spec:
  type: ClusterIP
  selector: {{- include "vd.selectorLabels" . | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.service.port }}
      targetPort: http
{{- end }}
{{- end -}}
