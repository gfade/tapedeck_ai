"
I test TdRun imported from the fixture store: run.json fields, steps, tool calls, request expansion, divergence, forks and replays, bare session files, usage.
"
Class {
	#name : 'TdRunTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'tests' }
TdRunTest >> testDivergenceOfTheFork [

	| divergence |
	divergence := self fork divergence.
	self assert: divergence step equals: self fork forkAt.
	self assert: divergence kind equals: #forced.
	self assert: divergence isForced.
	self assert: divergence at equals: 'request'.
	self assert: divergence wentLive.
	self assert: divergence restoredSnapshot notNil.
	self assert: (divergence description includesSubstring: 'forced').
	self assert: (self fork stepAt: divergence step) isDivergencePoint.
	self deny: (self fork stepAt: divergence step - 1) isDivergencePoint.
	self assert: self baseline divergence isNil.
	self assert: self replay divergence isNil
]

{ #category : 'tests' }
TdRunTest >> testForkReplaysThenGoesLive [

	| fork forkAt |
	fork := self fork.
	forkAt := fork forkAt.
	self assert: fork isFork.
	self assert: fork parent equals: self baseline.
	self assert: forkAt equals: 4.
	self assert: fork lenient equals: #( 'system' ).
	self assert: fork passed.
	self assert: ((fork steps first: forkAt - 1) allSatisfy: [ :step |
			 step isReplayed and: [ step tools allSatisfy: [ :call | call isStubbed ] ] ]).
	self assert: ((fork steps allButFirst: forkAt - 1) allSatisfy: [ :step | step isLive ]).
	self assert: fork savedUsage totalTokens > 0.
	self assert: fork tokens equals: (TdUsage sumOf: (fork liveSteps collect: [ :each | each usage ])) totalTokens
]

{ #category : 'tests' }
TdRunTest >> testImportsABareSessionFile [

	| run |
	run := TdRun fromSessionFile: self baseline directory / 'session.jsonl'.
	self assert: run id equals: 'session'.
	self assert: run variant equals: self baseline variant.
	self assert: run kind equals: #run.
	self assert: run stepCount equals: self baseline stepCount.
	self assert: run tokens equals: self baseline recordedUsage totalTokens.
	self assert: run model equals: self baseline model.
	self assert: run pass isNil
]

{ #category : 'tests' }
TdRunTest >> testImportsRunJson [

	| run |
	run := self baseline.
	self assert: run task equals: 't01'.
	self assert: run split equals: (run info at: 'split').
	self assert: run kind equals: #run.
	self assert: run isRecorded.
	self assert: run variant equals: 'vanilla'.
	self assert: run failed.
	self assert: (run verify at: 'pass') equals: false.
	self assert: run tokens equals: ((run info at: 'usage') at: 'totalTokens').
	self assert: run tokens equals: run recordedUsage totalTokens.
	self assert: run startedAt notNil.
	self assert: run model notNil.
	self assert: run cwd notNil.
	self assert: run report notNil.
	self assert: run isFinished
]

{ #category : 'tests' }
TdRunTest >> testReplayHasNoVerdict [

	| replay |
	replay := self replay.
	self assert: replay isReplay.
	self assert: replay pass isNil.
	self assert: replay verdictString equals: '-'.
	self assert: replay tokens equals: 0.
	self assert: replay parent equals: self baseline.
	self assert: (replay steps allSatisfy: [ :each | each isReplayed ])
]

{ #category : 'tests' }
TdRunTest >> testRequestsAreExpandedFromDeltas [

	| run |
	run := self baseline.
	run steps do: [ :step |
		| keep previous |
		keep := step requestDelta at: 'keep'.
		previous := step index = 1
			            ifTrue: [ #(  ) ]
			            ifFalse: [ (run stepAt: step index - 1) request ].
		self assert: step request size equals: keep + (step requestDelta at: 'append') size.
		self assert: (step request first: keep) equals: (previous first: keep) ].
	self assert: (run stepAt: 1) request first isSystem.
	self assert: (run stepAt: 1) request second isUser
]

{ #category : 'tests' }
TdRunTest >> testRequestsEndWithThePreviousResponseAndResults [

	| run |
	run := self baseline.
	2 to: run stepCount do: [ :index |
		| request previous |
		request := (run stepAt: index) request.
		previous := run stepAt: index - 1.
		previous tools ifNotEmpty: [
			self assert: (request at: request size - previous tools size) isAssistant.
			self assert: request last isToolResult.
			self assert: request last toolCallId equals: previous tools last id ] ]
]

{ #category : 'tests' }
TdRunTest >> testStepsAndToolCalls [

	| run step call |
	run := self baseline.
	self assert: run stepCount equals: run session tapeSteps size.
	self assert: (run steps collect: [ :each | each index ]) asArray equals: (1 to: run stepCount) asArray.
	self assert: (run steps allSatisfy: [ :each | each isLive and: [ each response isAssistant ] ]).
	step := run stepAt: 4.
	self assert: step tools size equals: 1.
	call := step tools first.
	self assert: call name equals: 'bash'.
	self assert: call command equals: 'npm test'.
	self assert: call summary equals: '$ npm test'.
	self assert: call isError.
	self assert: call exec equals: #real.
	self assert: call isExecuted.
	self deny: call isBlocked.
	self assert: call resultText notEmpty.
	self assert: call snapshot notNil.
	self assert: call step == step.
	self assert: call run == run.
	self assert: step snapshotAfter notNil.
	self assert: step response toolCalls first id equals: call id.
	self assert: (run toolCalls includes: call).
	self assert: (run stepAt: 99) isNil
]

{ #category : 'tests' }
TdRunTest >> testUsageSums [

	| first second sum |
	first := TdUsage fromDictionary:
		         (TdJson fromString: '{"input":10,"output":5,"cacheRead":1,"cacheWrite":0,"totalTokens":16,"cost":{"total":0.1}}').
	second := TdUsage fromDictionary: (TdJson fromString: '{"input":1,"output":1,"totalTokens":2,"cost":0.2}').
	sum := first + second.
	self assert: sum totalTokens equals: 18.
	self assert: sum input equals: 11.
	self assert: sum cacheRead equals: 1.
	self assert: sum roundedCost equals: 0.3.
	self assert: (sum asDictionary at: 'cost') equals: 0.3.
	self assert: (TdUsage fromDictionary: nil) isZero.
	self assert: (TdUsage sumOf: #(  )) isZero
]
