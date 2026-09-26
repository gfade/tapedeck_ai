"
I am signaled when the TapeDeck runner answers with an HTTP error (its body is {""error"": ""...""}) or cannot be reached. statusCode is nil when there was no answer.
"
Class {
	#name : 'TdRunnerError',
	#superclass : 'Error',
	#instVars : [
		'statusCode'
	],
	#category : 'TapeDeck-Server',
	#package : 'TapeDeck-Server'
}

{ #category : 'accessing' }
TdRunnerError >> statusCode [

	^ statusCode
]

{ #category : 'accessing' }
TdRunnerError >> statusCode: anInteger [

	statusCode := anInteger
]
