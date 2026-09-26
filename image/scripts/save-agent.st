| client agent |
client := TdRunnerClient new.
agent := TdAgentImage captureFrom: client.
(Smalltalk imagePath asFileReference parent /
	(Smalltalk imagePath asFileReference basenameWithoutExtension , '.archive.json'))
	writeStreamDo: [ :stream | stream nextPutAll: (TdJson toString: agent archive) ].
Stdio stdout
	nextPutAll: 'Captured ' , agent store size printString , ' runs and '
		, agent fileNames size printString , ' files inside Agent.image';
	lf; flush.
Smalltalk garbageCollect.
Smalltalk snapshot: true andQuit: true.
